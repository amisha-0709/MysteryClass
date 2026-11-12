import { Link } from "react-router-dom";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export default function NotFound() {
  useDocumentTitle("Not found");
  return (
    <div className="atmosphere relative grid min-h-dvh place-items-center px-4">
      <div className="relative z-10 text-center">
        <p className="eyebrow">404 · File not found</p>
        <h1 className="mt-4 font-display text-5xl text-paper">This lead goes nowhere.</h1>
        <Link to="/" className="btn-ghost mt-8">
          Back to the start
        </Link>
      </div>
    </div>
  );
}
