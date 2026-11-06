import { useEffect, useState } from "react";

export type Route =
  | { name: "queue" }
  | { name: "new" }
  | { name: "edit"; id: string }
  | { name: "settings" }
  | { name: "replies" };

function parse(hash: string): Route {
  const path = hash.replace(/^#/, "") || "/";
  if (path === "/new") return { name: "new" };
  if (path === "/settings") return { name: "settings" };
  if (path === "/replies") return { name: "replies" };
  const m = path.match(/^\/post\/([0-9a-f-]{36})$/i);
  if (m) return { name: "edit", id: m[1] };
  return { name: "queue" };
}

export function go(path: string) {
  window.location.hash = path;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parse(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
