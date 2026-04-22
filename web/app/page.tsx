import { redirect } from "next/navigation";

// Root URL redirects to dashboard; middleware will bounce to /login if not authenticated.
export default function RootPage() {
  redirect("/dashboard");
}
