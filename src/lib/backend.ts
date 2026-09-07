/** Local mode preserves the existing demo. Hosted deployments must use Supabase. */
export function usesSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (Boolean(url) !== Boolean(key))
    throw new Error("Configure both Supabase URL and publishable key.");
  if (process.env.VERCEL && !url)
    throw new Error("Supabase must be configured before deploying Connectus.");
  return Boolean(url && key);
}
