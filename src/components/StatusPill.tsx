import { CircleCheck, CircleDashed, Clock3, LoaderCircle, TriangleAlert } from "lucide-react";
import type { PostStatus } from "../lib/types";

// Monochrome on purpose: each status is told apart by icon, label and fill, never by color.
const MAP: Record<PostStatus, { label: string; Icon: typeof Clock3 }> = {
  draft: { label: "Draft", Icon: CircleDashed },
  scheduled: { label: "Scheduled", Icon: Clock3 },
  publishing: { label: "Publishing", Icon: LoaderCircle },
  posted: { label: "Posted", Icon: CircleCheck },
  failed: { label: "Failed", Icon: TriangleAlert },
};

export function StatusPill({ status }: { status: PostStatus }) {
  const { label, Icon } = MAP[status];
  return (
    <span className={`pill pill--${status}`}>
      <Icon size={13} strokeWidth={2} aria-hidden className={status === "publishing" ? "spin" : undefined} />
      {label}
    </span>
  );
}
