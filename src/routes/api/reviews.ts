import { createFileRoute } from "@tanstack/react-router";

import { reviewsRepo } from "@/lib/repos.server";

// GET /api/reviews
// Returns all approved reviews for the web page.
export const Route = createFileRoute("/api/reviews")({
  server: {
    handlers: {
      GET: async () => {
        const reviews = await reviewsRepo.approved();
        return new Response(JSON.stringify(reviews), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
