import { MetaProvider, Title } from "@solidjs/meta";
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { Suspense } from "solid-js";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5_000 },
  },
});

export default function App() {
  return (
    <Router
      root={(props) => (
        <MetaProvider>
          <Title>Redibook — Product Knowledge Impact</Title>
          <QueryClientProvider client={queryClient}>
            <Suspense fallback={<div class="route-loading" role="status">Opening workspace...</div>}>
              {props.children}
            </Suspense>
          </QueryClientProvider>
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
