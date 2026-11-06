export type PostStatus = "draft" | "scheduled" | "publishing" | "posted" | "failed";

export interface Post {
  id: string;
  parts: string[];
  status: PostStatus;
  scheduled_at: string | null;
  posted_at: string | null;
  x_post_ids: string[];
  error: string | null;
  attempts: number;
  source: "manual" | "claude";
  note: string | null;
  created_at: string;
  updated_at: string;
  // Daily batch fields (Claude's candidates)
  batch_date: string | null;
  score: number | null;
  slot: number | null;
  picked: boolean;
  angle: string | null;
  recommended: boolean;
  review: string | null;
}

export interface Settings {
  long_posts: boolean;
  x_username: string | null;
  x_name: string | null;
  x_connected_at: string | null;
  publisher_last_run: string | null;
  publisher_last_result: string | null;
  daily_posts: number;
  slot_timezone: string;
  slot_times: string[];
  pick_cutoff_minutes: number;
  ai_connected: boolean;
  ai_model: string;
  watcher_last_run: string | null;
  watcher_last_result: string | null;
  watcher_enabled: boolean;
  telegram_connected: boolean;
  telegram_bot: string | null;
}

export type ReplyStatus = "new" | "ready" | "skipped" | "replied" | "dismissed" | "failed";

export interface ReplyTarget {
  id: string;
  account_id: string | null;
  tweet_id: string;
  author_username: string;
  author_name: string | null;
  author_followers: number | null;
  text: string;
  posted_at: string | null;
  metrics: { like_count?: number; reply_count?: number; retweet_count?: number; impression_count?: number } | null;
  status: ReplyStatus;
  drafts: { angle: string; text: string }[] | null;
  ai_note: string | null;
  replied_text: string | null;
  replied_at: string | null;
  error: string | null;
  fetched_at: string;
}

export interface WatchAccount {
  id: string;
  username: string;
  x_user_id: string | null;
  name: string | null;
  followers: number | null;
  category: string | null;
  active: boolean;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface Batch {
  batch_date: string;
  created_at: string;
  candidate_count: number;
  locked_at: string | null;
  locked_by: "owner" | "auto" | null;
  scheduled_count: number | null;
}
