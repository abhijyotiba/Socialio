import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/db/types";

export async function updateSession(request: NextRequest) {
  // Forward pathname so Server Components can read it via headers() without
  // needing a client-side usePathname call.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request: { headers: requestHeaders },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session — do not add logic between createServerClient and getUser.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    requestHeaders.set("x-user-id", user.id);
    requestHeaders.set("x-user-email", user.email || "");
    
    const finalResponse = NextResponse.next({
      request: { headers: requestHeaders },
    });
    
    // Copy any cookies set during the cookies.setAll call
    supabaseResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") {
        finalResponse.headers.append(key, value);
      }
    });
    supabaseResponse = finalResponse;
  }

  return { supabaseResponse, user };
}
