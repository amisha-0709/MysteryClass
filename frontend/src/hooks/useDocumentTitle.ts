import { useEffect } from "react";

/** Sets the tab title ("Briefing · Case 001 · Mystery Class"), so history and tabs are readable. */
export function useDocumentTitle(...parts: (string | undefined | null | false)[]) {
  const title = [...parts.filter(Boolean), "Mystery Class"].join(" · ");
  useEffect(() => {
    document.title = title;
  }, [title]);
}
