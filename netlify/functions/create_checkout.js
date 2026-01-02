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

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Upsert + read back (proof)
    const { data: upserted, error: upsertErr } = await supabaseAdmin
      .from("profiles")
      .upsert(
        { user_id, email, plan: "plus", status: "pending" },
        { onConflict: "user_id" }
      )
      .select("*");

    if (upsertErr) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "UPSERT FAILED: " + upsertErr.message })
      };
    }

    const origin =
      process.env.URL ||
      event.headers.origin ||
      (event.headers.referer ? new URL(event.headers.referer).origin : "");

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${origin}/dashboard.html?paid=1`,
      cancel_url: `${origin}/create-account.html?canceled=1`,
      metadata: { supabase_user_id: user_id }
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: session.url,
        debug_supabase_url: process.env.SUPABASE_URL,
        debug_rows_returned: upserted?.length || 0,
        debug_first_row: upserted?.[0] || null
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};

