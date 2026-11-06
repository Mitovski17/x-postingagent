import { useMemo } from "react";
import { usePosts, useReplyTargets, useSession, useSettings } from "./lib/data";
import { useRoute } from "./lib/router";
import { Shell } from "./components/Shell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Login } from "./pages/Login";
import { Queue } from "./pages/Queue";
import { Editor } from "./pages/Editor";
import { Settings } from "./pages/Settings";
import { Replies } from "./pages/Replies";

export function App() {
  const { session, isOwner, ready } = useSession();
  const route = useRoute();
  const allowed = !!session && isOwner === true;
  const { posts, loading } = usePosts(allowed);
  const { settings, refresh } = useSettings(allowed);
  const { targets } = useReplyTargets(allowed);
  const readyReplies = useMemo(() => targets.filter((t) => t.status === "ready").length, [targets]);

  const upcoming = useMemo(
    () => posts.filter((p) => p.status === "scheduled" || p.status === "publishing").length,
    [posts],
  );

  if (!ready || (session && isOwner === null)) return <div className="boot" aria-busy="true" />;
  if (!session) return <Login />;
  if (!isOwner) return <Login deniedEmail={session.user.email} />;

  return (
    <Shell route={route} settings={settings} upcoming={upcoming} replies={readyReplies}>
      <ErrorBoundary key={route.name === "edit" ? `edit-${route.id}` : route.name}>
        {route.name === "queue" && <Queue posts={posts} loading={loading} settings={settings} />}
        {route.name === "new" && <Editor key="new" settings={settings} />}
        {route.name === "edit" && <Editor key={route.id} id={route.id} settings={settings} />}
        {route.name === "replies" && <Replies settings={settings} />}
        {route.name === "settings" && <Settings settings={settings} session={session} refresh={refresh} />}
      </ErrorBoundary>
    </Shell>
  );
}
