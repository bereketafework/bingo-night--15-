import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.warn("Supabase environment variables are not configured");
}

export const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Initialize Supabase connection by triggering a simple health query.
 */
export const initializeSupabase = async (): Promise<void> => {
  console.log("Initializing Supabase connection...");
  try {
    const { error } = await supabase.from("user").select("id").limit(1);
    if (error && error.code !== "PGRST116") {
      throw error;
    }
    console.log("Supabase connection verified.");
  } catch (e: any) {
    console.error("Supabase initialization error:", e);
    throw new Error(
      `Failed to initialize Supabase: ${e.message}. Please refresh the page to try again.`,
    );
  }
};
