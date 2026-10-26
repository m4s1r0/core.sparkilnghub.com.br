import "./styles/layers.css";
import "@sparkling-hub/design-system/styles.css";
import "./styles/app.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { SystemStatusPage } from "./pages/system-status/SystemStatusPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([{ path: "/", element: <SystemStatusPage /> }]);

const root = document.getElementById("root");
if (!root) throw new Error("Elemento #root ausente");

createRoot(root).render(
  <StrictMode>
    <div className="sh-theme min-h-dvh">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </div>
  </StrictMode>,
);
