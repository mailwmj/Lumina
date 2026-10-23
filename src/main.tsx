import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./i18n";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
import "react-image-crop/dist/ReactCrop.css";

const devMockReady: Promise<unknown> =
  import.meta.env.DEV && new URLSearchParams(location.search).has("mockCanvas")
    ? import("./dev/mockCanvasIpc")
    : Promise.resolve();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

void devMockReady.then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  );
});
