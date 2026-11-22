import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";

// One server function for the whole app. A route with its own config is
// built into a separate Vercel function, and with lazy route discovery the
// main function then can't tell the browser that route exists: clicking it in
// the app menu showed "404 Not Found" (Speed test). Every route inherits this,
// so they all share one bundle. 60 s covers a Google PageSpeed run.
export const config = { maxDuration: 60 };

export default function App() {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
