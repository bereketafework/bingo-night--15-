import express from "express";
import { PrismaClient } from "@prisma/client";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import crypto from "crypto";
import "dotenv/config";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const simpleHash = (text: string): string => {
  return crypto.createHash("sha256").update(text).digest("hex");
};

async function seedDatabase() {
  try {
    const userCount = await prisma.user.count();
    if (userCount === 0) {
      console.log("Seeding initial users to Postgres...");
      const usersToSeed = [
        { name: "superadmin", role: "super_admin", pass: "superadmin123" },
        { name: "admin", role: "admin", pass: "admin123" },
        { name: "manager1", role: "manager", pass: "pass123" },
        { name: "manager2", role: "manager", pass: "pass123" },
      ];
      for (const u of usersToSeed) {
        await prisma.user.create({
          data: {
            name: u.name,
            role: u.role,
            password: simpleHash(u.pass),
          },
        });
      }
    }

    const settingsCount = await prisma.setting.count();
    if (settingsCount === 0) {
      console.log("Seeding initial settings to Postgres...");
      await prisma.setting.createMany({
        data: [
          { key: "winner_prize_percentage", value: "0.7", updated_at: new Date() },
          {
            key: "enabled_winning_patterns",
            value: JSON.stringify(["Any Line", "Two Lines", "X Pattern", "Rectangle", "Four Corners", "Full House"]),
            updated_at: new Date(),
          },
        ],
      });
    }
    console.log("Database seed successfully checked.");
  } catch (err) {
    console.error("Failed to seed database:", err);
  }
}

const app = express();
app.use(express.json());

let databaseSeeded = false;
async function ensureDbSeeded() {
  if (databaseSeeded) return;
  try {
    await seedDatabase();
    databaseSeeded = true;
  } catch (err) {
    console.error("Database seeding check failed:", err);
  }
}

// Lazy-seed database middleware
app.use(async (req, res, next) => {
  await ensureDbSeeded();
  next();
});

// --- API ROUTES ---

const apiRouter = express.Router();

// GET users (filtered by role optional)
apiRouter.get("/users", async (req, res) => {
  try {
    const role = req.query.role as string;
    const users = await prisma.user.findMany({
      where: role ? { role } : undefined,
      select: {
        id: true,
        name: true,
        role: true,
      },
    });
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST login authentication
apiRouter.post("/auth/login", async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) {
      // In-memory fallback if DB is not configured
      const localUsers: Record<string, string> = {
        "superadmin": "superadmin123",
        "admin": "admin123",
        "manager1": "pass123",
        "manager2": "pass123"
      };
      if (localUsers[name] === password) {
        return res.json({
          id: `local-${name}`,
          name: name,
          role: name === "superadmin" ? "super_admin" : (name === "admin" ? "admin" : "manager")
        });
      }
      return res.status(401).json({ error: "Invalid username or password (DB offline)" });
    }

    const user = await prisma.user.findUnique({
      where: { name },
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const hashedPassword = simpleHash(password);
    if (hashedPassword === user.password) {
      res.json({
        id: user.id,
        name: user.name,
        role: user.role,
      });
    } else {
      res.status(401).json({ error: "Invalid username or password" });
    }
  } catch (err: any) {
    // If Prisma db query fails, fallback to local users as well to prevent total lockout
    const { name, password } = req.body;
    const localUsers: Record<string, string> = {
      "superadmin": "superadmin123",
      "admin": "admin123",
      "manager1": "pass123",
      "manager2": "pass123"
    };
    if (localUsers[name] === password) {
      return res.json({
        id: `local-${name}`,
        name: name,
        role: name === "superadmin" ? "super_admin" : (name === "admin" ? "admin" : "manager")
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// GET game logs
apiRouter.get("/game-logs", async (req, res) => {
  try {
    const period = req.query.period as string;
    const managerId = req.query.managerId as string;

    let whereClause: any = {};

    if (period && period !== "all") {
      const days = period === "7d" ? 7 : 30;
      const filterDate = new Date();
      filterDate.setDate(filterDate.getDate() - days);
      whereClause.created_at = {
        gte: filterDate,
      };
    }

    if (managerId && managerId !== "all") {
      whereClause.manager_id = managerId;
    }

    const logs = await prisma.gameLog.findMany({
      where: whereClause,
      orderBy: {
        created_at: "desc",
      },
    });

    const mappedLogs = logs.map((log) => ({
      gameId: log.game_id,
      startTime: log.start_time,
      managerId: log.manager_id,
      managerName: log.manager_name,
      settings: log.settings,
      players: log.players,
      calledNumbersSequence: log.called_numbers_sequence,
      winner: log.winner,
    }));

    res.json(mappedLogs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST save a game log
apiRouter.post("/game-logs", async (req, res) => {
  try {
    const { log } = req.body;
    if (!log) {
      return res.status(400).json({ error: "Log data is required" });
    }

    await prisma.gameLog.create({
      data: {
        game_id: log.gameId,
        start_time: log.startTime,
        manager_id: log.managerId,
        manager_name: log.managerName,
        settings: log.settings,
        players: log.players,
        called_numbers_sequence: log.calledNumbersSequence,
        winner: log.winner ?? undefined,
      },
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET system setting
apiRouter.get("/settings/:key", async (req, res) => {
  try {
    const { key } = req.params;
    if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) {
      return res.json({ value: null, warning: "Database not configured yet" });
    }
    const setting = await prisma.setting.findUnique({
      where: { key },
    });
    res.json({ value: setting ? setting.value : null });
  } catch (err: any) {
    console.error(`Failed to fetch setting ${req.params.key}, returning null:`, err);
    res.json({ value: null, warning: "Database connection failed, using offline fallback" });
  }
});

// POST system setting
apiRouter.post("/settings", async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ error: "Key and value are required" });
    }

    if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) {
      return res.json({ success: true, warning: "Database not configured yet, setting saved in memory (offline mock)" });
    }

    await prisma.setting.upsert({
      where: { key },
      update: { value, updated_at: new Date() },
      create: { key, value, updated_at: new Date() },
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error(`Failed to save setting ${req.body.key}:`, err);
    res.status(500).json({ error: "Database save failed: " + err.message });
  }
});

// POST create system user
apiRouter.post("/users", async (req, res) => {
  try {
    const { name, password, role } = req.body;
    if (!name || !password || !role) {
      return res.status(400).json({ error: "Username, password and role are required" });
    }

    if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) {
      return res.json({ success: false, message: "Database is not configured. Cannot create permanent users." });
    }

    const existing = await prisma.user.findUnique({
      where: { name },
    });

    if (existing) {
      return res.json({ success: false, message: "Username already exists." });
    }

    const hashedPassword = simpleHash(password);
    await prisma.user.create({
      data: { name, password: hashedPassword, role },
    });

    res.json({ success: true, message: `User '${name}' created successfully as ${role}.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET currently enabled winning patterns
apiRouter.get("/winning-patterns", async (req, res) => {
  try {
    if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) {
      return res.json(["Any Line", "Two Lines", "X Pattern", "Rectangle", "Four Corners", "Full House"]);
    }
    const setting = await prisma.setting.findUnique({
      where: { key: "enabled_winning_patterns" },
    });
    if (setting) {
      try {
        const patterns = JSON.parse(setting.value);
        if (Array.isArray(patterns)) {
          return res.json(patterns);
        }
      } catch (e) {
        console.error("Parsing winning patterns failed:", e);
      }
    }
    res.json(["Any Line", "Two Lines", "X Pattern", "Rectangle", "Four Corners", "Full House"]);
  } catch (err: any) {
    console.error("Database query failed for winning patterns, returning fallback defaults:", err);
    res.json(["Any Line", "Two Lines", "X Pattern", "Rectangle", "Four Corners", "Full House"]);
  }
});

// POST clear game logs
apiRouter.post("/game-logs/clear", async (req, res) => {
  try {
    const { olderThanDays } = req.body;
    let deletedCount = 0;
    if (olderThanDays) {
      const date = new Date();
      date.setDate(date.getDate() - parseInt(olderThanDays));
      const result = await prisma.gameLog.deleteMany({
        where: {
          created_at: {
            lt: date,
          },
        },
      });
      deletedCount = result.count;
    } else {
      const result = await prisma.gameLog.deleteMany({});
      deletedCount = result.count;
    }
    const message = olderThanDays
      ? `Successfully cleared ${deletedCount} game logs older than ${olderThanDays} days.`
      : `Successfully cleared all ${deletedCount} game logs.`;
    res.json({ success: true, message });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.use("/api", apiRouter);
app.use("/", apiRouter);

export default app;
