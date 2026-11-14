import { Search } from "lucide-react";
import { Link } from "react-router-dom";

export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <Link to="/" className="group inline-flex shrink-0 items-center gap-2.5" aria-label="Mystery Class home">
      <span className="grid size-8 place-items-center rounded-sm border border-gold-700 bg-ink-900 text-gold-500 transition group-hover:border-gold-500">
        <Search className="size-4" strokeWidth={2.25} />
      </span>
      <span
        className={`font-display font-semibold tracking-[0.12em] whitespace-nowrap text-paper uppercase sm:tracking-[0.18em] ${
          size === "lg" ? "text-xl" : "text-sm sm:text-base"
        }`}
      >
        Mystery Class
      </span>
    </Link>
  );
}
