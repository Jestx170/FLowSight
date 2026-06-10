import { useEffect, useState } from "react";

export type RoutePath = "/live" | "/dashboard" | "/zones" | "/behaviors" | "/heatmap" | "/settings";

function parse(): RoutePath {
  const h = window.location.hash.replace(/^#/, "") || "/live";
  const valid: RoutePath[] = ["/live", "/dashboard", "/zones", "/behaviors", "/heatmap", "/settings"];
  return (valid.includes(h as RoutePath) ? h : "/live") as RoutePath;
}

export function useHashRoute(): RoutePath {
  const [route, setRoute] = useState<RoutePath>(parse());
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    if (!window.location.hash) window.location.hash = "/live";
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function navigate(to: RoutePath) {
  window.location.hash = to;
}
