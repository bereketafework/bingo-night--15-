import { User, GameAuditLog, FilterPeriod, UserRole, WinningPattern } from '../types';

/**
 * Initializes DB connection by triggering a simple health query to the backend.
 */
export const initializeDb = async (): Promise<void> => {
    console.log("Initializing database connection via backend API...");
    try {
        const response = await fetch('/api/winning-patterns');
        if (!response.ok) {
            throw new Error(`Server returned status ${response.status}`);
        }
        console.log("Database connection & API verified.");
    } catch (e: any) {
        console.error("Database initialization error:", e);
        throw new Error(`Failed to initialize application data: ${e.message}. Please refresh the page to try again.`);
    }
};

/**
 * Retrieves the list of users from the server.
 */
export const getUsers = async (role?: UserRole): Promise<User[]> => {
    try {
        const url = role ? `/api/users?role=${role}` : '/api/users';
        const response = await fetch(url);
        if (!response.ok) throw new Error("Failed to fetch users");
        return await response.json();
    } catch (e) {
        console.error('Error fetching users:', e);
        return [];
    }
};

/**
 * Authenticates a user against the backend.
 */
export const authenticateUser = async (name: string, passwordAttempt: string): Promise<User | null> => {
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, password: passwordAttempt })
        });
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        console.error('Authentication error:', e);
        return null;
    }
};

/**
 * Fetches game audit logs with filters from the server.
 */
export const getGameLogs = async (filters: { period?: FilterPeriod; managerId?: string } = {}): Promise<GameAuditLog[]> => {
    try {
        const queryParams = new URLSearchParams();
        if (filters.period) queryParams.append('period', filters.period);
        if (filters.managerId) queryParams.append('managerId', filters.managerId);
        
        const response = await fetch(`/api/game-logs?${queryParams.toString()}`);
        if (!response.ok) throw new Error("Failed to fetch game logs");
        return await response.json();
    } catch (e) {
        console.error('Error fetching game logs:', e);
        return [];
    }
};

/**
 * Saves a game audit log payload back to the server.
 */
export const saveGameLog = async (log: GameAuditLog): Promise<void> => {
    try {
        const response = await fetch('/api/game-logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ log })
        });
        if (!response.ok) throw new Error("Failed to save game log");
    } catch (e) {
        console.error('Error saving game log:', e);
    }
};

/**
 * Retrieves a single setting value.
 */
export const getSetting = async (key: string): Promise<string | null> => {
    try {
        const response = await fetch(`/api/settings/${encodeURIComponent(key)}`);
        if (!response.ok) return null;
        const data = await response.json();
        return data.value;
    } catch (e) {
        console.error(`Error getting setting ${key}:`, e);
        return null;
    }
};

/**
 * Updates a single setting value.
 */
export const setSetting = async (key: string, value: string): Promise<void> => {
    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value })
        });
        if (!response.ok) throw new Error("Failed to save setting");
    } catch (e) {
        console.error(`Error configuring setting ${key}:`, e);
    }
};

/**
 * Creates a new manager or admin user on the system.
 */
export const createUser = async (name: string, passwordAttempt: string, role: 'manager' | 'admin'): Promise<{ success: boolean; message: string }> => {
    try {
        const response = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, password: passwordAttempt, role })
        });
        if (!response.ok) {
            const data = await response.json();
            return { success: false, message: data.error || 'Failed to create user.' };
        }
        return await response.json();
    } catch (e: any) {
        console.error('Error creating user:', e);
        return { success: false, message: e.message || 'Database error while creating user.' };
    }
};

/**
 * Fetches the currently enabled patterns on the platform.
 */
export const getEnabledWinningPatterns = async (): Promise<WinningPattern[]> => {
    try {
        const response = await fetch('/api/winning-patterns');
        if (!response.ok) throw new Error("Failed to fetch enabled landing patterns");
        return await response.json();
    } catch (e) {
        console.error("Failed to parse default winning patterns:", e);
        return Object.values(WinningPattern);
    }
};

/**
 * Clears old or all game audit logs on request.
 */
export const clearGameLogs = async (olderThanDays?: number): Promise<{ success: boolean; message: string }> => {
    try {
        const response = await fetch('/api/game-logs/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ olderThanDays })
        });
        if (!response.ok) {
            const data = await response.json();
            return { success: false, message: data.error || 'Failed to clear game logs.' };
        }
        return await response.json();
    } catch (e: any) {
        console.error('Error clearing game logs:', e);
        return { success: false, message: e.message || 'Failed to clear logs.' };
    }
};
