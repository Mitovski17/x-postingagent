import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Batch, Post, ReplyTarget, Settings, WatchAccount } from "./types";

// Every hook instance gets its own realtime channel. Two components using the same
// hook (the sidebar count and the Replies page both read reply targets) would
// otherwise share one channel, and Supabase throws when a second listener is added
// to a channel that's already subscribed.
let channelSeq = 0;
const uniq = (name: string) => `${name}-${++channelSeq}`;

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setIsOwner(null);
      return;
    }
    supabase.rpc("is_owner").then(({ data }) => setIsOwner(data === true));
  }, [session?.user.id]);

  return { session, isOwner, ready };
}

export function usePosts(enabled: boolean) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("posts")
      .select("*")
      .order("scheduled_at", { ascending: true, nullsFirst: false })
      .limit(1000);
    setPosts((data as Post[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const ch = supabase
      .channel(uniq("posts-live"))
      .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, refresh)
      .subscribe();
    // Safety net in case a realtime event is missed.
    const t = setInterval(refresh, 60_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, [enabled, refresh]);

  return { posts, loading, refresh };
}

export function useSettings(enabled: boolean) {
  const [settings, setSettings] = useState<Settings | null>(null);

  const refresh = useCallback(async () => {
    const { data } = await supabase.from("app_settings").select("*").eq("id", true).maybeSingle();
    setSettings(data as Settings | null);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const ch = supabase
      .channel(uniq("settings-live"))
      .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, refresh)
      .subscribe();
    const t = setInterval(refresh, 30_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, [enabled, refresh]);

  return { settings, refresh };
}

// Re-render every `ms` so relative times stay fresh.
export function useNow(ms = 15_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export async function invoke<T = any>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    let msg = error.message;
    try {
      const ctx = await (error as any).context?.json?.();
      if (ctx?.error) msg = ctx.error;
    } catch { /* keep generic message */ }
    throw new Error(msg);
  }
  return data as T;
}

export function useBatches(enabled: boolean) {
  const [batches, setBatches] = useState<Batch[]>([]);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("daily_batches")
      .select("*")
      .order("batch_date", { ascending: false })
      .limit(30);
    setBatches((data as Batch[]) ?? []);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const ch = supabase
      .channel(uniq("batches-live"))
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_batches" }, refresh)
      .subscribe();
    const t = setInterval(refresh, 60_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, [enabled, refresh]);

  return { batches, refresh };
}

export function useReplyTargets(enabled: boolean) {
  const [targets, setTargets] = useState<ReplyTarget[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data } = await supabase
      .from("reply_targets")
      .select("*")
      .gte("fetched_at", since)
      .order("posted_at", { ascending: false })
      .limit(500);
    setTargets((data as ReplyTarget[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const ch = supabase
      .channel(uniq("targets-live"))
      .on("postgres_changes", { event: "*", schema: "public", table: "reply_targets" }, refresh)
      .subscribe();
    const t = setInterval(refresh, 60_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, [enabled, refresh]);

  return { targets, loading, refresh };
}

export function useWatchAccounts(enabled: boolean) {
  const [accounts, setAccounts] = useState<WatchAccount[]>([]);

  const refresh = useCallback(async () => {
    const { data } = await supabase.from("watch_accounts").select("*").order("followers", { ascending: false, nullsFirst: false });
    setAccounts((data as WatchAccount[]) ?? []);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const ch = supabase
      .channel(uniq("watch-live"))
      .on("postgres_changes", { event: "*", schema: "public", table: "watch_accounts" }, refresh)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [enabled, refresh]);

  return { accounts, refresh };
}
