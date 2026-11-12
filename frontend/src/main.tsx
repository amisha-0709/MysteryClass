import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, ScrollRestoration } from "react-router-dom";
import { CaseLayout } from "./components/CaseLayout";
import Dashboard from "./pages/Dashboard";
import Landing from "./pages/Landing";
import NotFound from "./pages/NotFound";
import Briefing from "./pages/Briefing";
import Accusation from "./pages/Accusation";
import EvidenceBoard from "./pages/EvidenceBoard";
import Interrogation from "./pages/Interrogation";
import Investigation from "./pages/Investigation";
import Results from "./pages/Results";
import RouteError from "./pages/RouteError";
import "./styles/index.css";

/** Root: new pages open at the top; back/forward restores the previous scroll position. */
function Root() {
  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      { path: "/", element: <Landing /> },
      { path: "/dashboard", element: <Dashboard /> },
      {
        path: "/case/:caseId",
        element: <CaseLayout />,
        children: [
          { index: true, element: <Navigate to="briefing" replace /> },
          { path: "briefing", element: <Briefing /> },
          { path: "investigation", element: <Investigation /> },
          { path: "interrogation", element: <Interrogation /> },
          { path: "board", element: <EvidenceBoard /> },
          { path: "accusation", element: <Accusation /> },
          // Closed cases live at /results/:sessionId; this keeps old links working.
          { path: "resolution", element: <Navigate to="/dashboard" replace /> },
        ],
      },
      { path: "/results/:sessionId", element: <Results /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
