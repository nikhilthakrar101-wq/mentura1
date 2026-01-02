const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const { email, user_id } = JSON.parse(event.body || "{}");
    if (!email || !user_id) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing email or user_id" })
      };
    }

    // Stripe + Supabase (server-side only)
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // 1) Mark the user as PENDING in Supabase until Stripe confirms payment
    const { error: upsertErr } = await supabaseAdmin
      .from("profiles")
      .upsert(
        { user_id, email, plan: "plus", status: "pending" },
        { onConflict: "user_id" }
      );

    if (upsertErr) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: upsertErr.message })
      };
    }

    // 2) Build success/cancel URLs
    // Netlify sets process.env.URL to your deployed site URL
    const origin =
      process.env.URL ||
      event.headers.origin ||
      (event.headers.referer ? new URL(event.headers.referer).origin : "");

    const successUrl = `${origin}/dashboard.html?paid=1`;
    const cancelUrl = `${origin}/create-account.html?canceled=1`;

    // 3) Create Stripe Checkout Session (SUBSCRIPTION)
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        supabase_user_id: user_id
      }
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: session.url })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
