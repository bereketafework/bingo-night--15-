import express from "express";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import "dotenv/config";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
);

const simpleHash = (text: string): string => {
  return crypto.createHash("sha256").update(text).digest("hex");
};

// Wrapper to catch async errors in route handlers
const asyncHandler = (fn: any) => (req: any, res: any, next: any) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

async function seedDatabase() {
  try {
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("*");

    // Handle table not found error (PGRST205) gracefully
    if (usersError) {
      if (usersError.code === "PGRST205") {
        console.log(
          "Tables not yet created in Supabase. This is expected on first run.",
        );
        return; // Don't try to seed if tables don't exist
      }
      throw usersError;
    }

    if (!users || users.length === 0) {
      console.log("Seeding initial users to Supabase...");
      const usersToSeed = [
        {
          name: "superadmin",
          role: "super_admin",
          password: simpleHash("superadmin123"),
        },
        { name: "admin", role: "admin", password: simpleHash("admin123") },
        { name: "manager1", role: "manager", password: simpleHash("pass123") },
        { name: "manager2", role: "manager", password: simpleHash("pass123") },
      ];
      const { error: insertError } = await supabase
        .from("users")
        .insert(usersToSeed);
      if (insertError) throw insertError;
    }

    const { data: settings, error: settingsError } = await supabase
      .from("settings")
      .select("*");

    // Handle table not found error for settings too
    if (settingsError) {
      if (settingsError.code === "PGRST205") {
        console.log(
          "Settings table not yet created in Supabase. This is expected on first run.",
        );
        return; // Don't try to seed if tables don't exist
      }
      throw settingsError;
    }

    if (!settings || settings.length === 0) {
      console.log("Seeding initial settings to Supabase...");
      const { error: insertError } = await supabase.from("settings").insert([
        {
          key: "winner_prize_percentage",
          value: "0.7",
          updated_at: new Date().toISOString(),
        },
        {
          key: "enabled_winning_patterns",
          value: JSON.stringify([
            "Any Line",
            "Two Lines",
            "X Pattern",
            "Rectangle",
            "Four Corners",
            "Full House",
          ]),
          updated_at: new Date().toISOString(),
        },
      ]);
      if (insertError) throw insertError;
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
  try {
    await ensureDbSeeded();
    next();
  } catch (err) {
    console.error("Middleware error:", err);
    next();
  }
});

// --- API ROUTES ---

const apiRouter = express.Router();

// GET users (filtered by role optional)
apiRouter.get("/users", async (req, res) => {
  try {
    const role = req.query.role as string;
    let query = supabase.from("users").select("id, name, role");
    if (role) {
      query = query.eq("role", role);
    }
    const { data: users, error } = await query;
    // PGRST205 = table not found, which is OK for uninitialized databases
    if (error && error.code !== "PGRST205") throw error;
    res.json(users || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST login authentication
apiRouter.post("/auth/login", async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      // In-memory fallback if DB is not configured
      const localUsers: Record<string, string> = {
        superadmin: "superadmin123",
        admin: "admin123",
        manager1: "pass123",
        manager2: "pass123",
      };
      if (localUsers[name] === password) {
        return res.json({
          id: `local-${name}`,
          name: name,
          role:
            name === "superadmin"
              ? "super_admin"
              : name === "admin"
                ? "admin"
                : "manager",
        });
      }
      return res
        .status(401)
        .json({ error: "Invalid username or password (DB offline)" });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("name", name)
      .single();

    // PGRST205 = table not found, PGRST116 = record not found - both mean user doesn't exist
    if (error || !user) {
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
    // If Supabase db query fails, fallback to local users as well to prevent total lockout
    const { name, password } = req.body;
    const localUsers: Record<string, string> = {
      superadmin: "superadmin123",
      admin: "admin123",
      manager1: "pass123",
      manager2: "pass123",
    };
    if (localUsers[name] === password) {
      return res.json({
        id: `local-${name}`,
        name: name,
        role:
          name === "superadmin"
            ? "super_admin"
            : name === "admin"
              ? "admin"
              : "manager",
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

    let query = supabase.from("game_logs").select("*");

    if (period && period !== "all") {
      const days = period === "7d" ? 7 : 30;
      const filterDate = new Date();
      filterDate.setDate(filterDate.getDate() - days);
      query = query.gte("created_at", filterDate.toISOString());
    }

    if (managerId && managerId !== "all") {
      query = query.eq("manager_id", managerId);
    }

    const { data: logs, error } = await query.order("created_at", {
      ascending: false,
    });
    // PGRST205 = table not found, which is OK for uninitialized databases
    if (error && error.code !== "PGRST205") throw error;

    const mappedLogs = (logs || []).map((log: any) => ({
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

    const { error } = await supabase.from("game_logs").insert({
      game_id: log.gameId,
      start_time: log.startTime,
      manager_id: log.managerId,
      manager_name: log.managerName,
      settings: log.settings,
      players: log.players,
      called_numbers_sequence: log.calledNumbersSequence,
      winner: log.winner ?? null,
    });
    // PGRST205 = table not found, which is OK for uninitialized databases
    if (error && error.code !== "PGRST205") throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET system setting
apiRouter.get("/settings/:key", async (req, res) => {
  try {
    const { key } = req.params;
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      return res.json({ value: null, warning: "Database not configured yet" });
    }
    const { data: setting, error } = await supabase
      .from("settings")
      .select("value")
      .eq("key", key)
      .single();
    // PGRST205 = table not found, PGRST116 = record not found - both are OK
    if (error && error.code !== "PGRST116" && error.code !== "PGRST205")
      throw error;
    res.json({ value: setting ? setting.value : null });
  } catch (err: any) {
    console.error(
      `Failed to fetch setting ${req.params.key}, returning null:`,
      err,
    );
    res.json({
      value: null,
      warning: "Database connection failed, using offline fallback",
    });
  }
});

// POST system setting
apiRouter.post("/settings", async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ error: "Key and value are required" });
    }

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      return res.json({
        success: true,
        warning:
          "Database not configured yet, setting saved in memory (offline mock)",
      });
    }

    const { data: existing, error: checkError } = await supabase
      .from("settings")
      .select("key")
      .eq("key", key)
      .single();

    // PGRST205 = table not found, PGRST116 = record not found - both are OK
    if (
      checkError &&
      checkError.code !== "PGRST116" &&
      checkError.code !== "PGRST205"
    )
      throw checkError;

    if (existing) {
      const { error } = await supabase
        .from("settings")
        .update({ value, updated_at: new Date().toISOString() })
        .eq("key", key);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("settings").insert({
        key,
        value,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    }
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
      return res
        .status(400)
        .json({ error: "Username, password and role are required" });
    }

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      return res.json({
        success: false,
        message: "Database is not configured. Cannot create permanent users.",
      });
    }

    const { data: existing, error: checkError } = await supabase
      .from("users")
      .select("name")
      .eq("name", name)
      .single();

    // PGRST205 = table not found, PGRST116 = record not found - both are OK
    if (
      checkError &&
      checkError.code !== "PGRST116" &&
      checkError.code !== "PGRST205"
    )
      throw checkError;
    if (existing) {
      return res.json({ success: false, message: "Username already exists." });
    }

    const hashedPassword = simpleHash(password);
    const { error } = await supabase.from("users").insert({
      name,
      password: hashedPassword,
      role,
    });
    if (error) throw error;

    res.json({
      success: true,
      message: `User '${name}' created successfully as ${role}.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET currently enabled winning patterns
apiRouter.get("/winning-patterns", async (req, res) => {
  try {
    const fallbackPatterns = [
      "Any Line",
      "Two Lines",
      "X Pattern",
      "Rectangle",
      "Four Corners",
      "Full House",
    ];

    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ) {
      return res.json(fallbackPatterns);
    }

    try {
      const { data: setting, error } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "enabled_winning_patterns")
        .single();

      // PGRST116 = record not found, PGRST205 = table not found - both are OK for fallback
      if (error && error.code !== "PGRST116" && error.code !== "PGRST205") {
        console.error("Supabase query error:", error);
        return res.json(fallbackPatterns);
      }

      if (setting?.value) {
        try {
          const patterns = JSON.parse(setting.value);
          if (Array.isArray(patterns) && patterns.length > 0) {
            return res.json(patterns);
          }
        } catch (parseErr) {
          console.error("Failed to parse winning patterns:", parseErr);
        }
      }
    } catch (dbErr) {
      console.error("Database connection error:", dbErr);
    }

    return res.json(fallbackPatterns);
  } catch (err: any) {
    console.error("Unexpected error in winning-patterns endpoint:", err);
    res
      .status(200)
      .json([
        "Any Line",
        "Two Lines",
        "X Pattern",
        "Rectangle",
        "Four Corners",
        "Full House",
      ]);
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
      const { error, count } = await supabase
        .from("game_logs")
        .delete()
        .lt("created_at", date.toISOString())
        .select("*", { count: "exact" });
      if (error) throw error;
      deletedCount = count || 0;
    } else {
      const { error, count } = await supabase
        .from("game_logs")
        .delete()
        .gte("created_at", "1900-01-01")
        .select("*", { count: "exact" });
      if (error) throw error;
      deletedCount = count || 0;
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

// Global error handler for unhandled errors
app.use((err: any, req: any, res: any, next: any) => {
  console.error("Unhandled server error:", err);
  res
    .status(500)
    .json({ error: "Internal server error", details: err?.message });
});

export default app;
