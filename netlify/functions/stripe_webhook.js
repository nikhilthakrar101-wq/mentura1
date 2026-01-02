const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const sig = event.headers["stripe-signature"];
  if (!sig) return { statusCode: 400, body: "Missing stripe-signature header" };

  // Stripe requires the raw body for signature verification
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return { statusCode: 400, body: `Bad signature: ${err.message}` };
  }

  try {
    // 1) Payment success: activate membership
    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object;

      const userId = session.metadata?.supabase_user_id;
      const customerId = session.customer;
      const subscriptionId = session.subscription;

      if (userId) {
        const { error } = await supabaseAdmin
          .from("profiles")
          .upsert(
            {
              user_id: userId,
              plan: "plus",
              status: "active",
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId
            },
            { onConflict: "user_id" }
          );

        if (error) throw error;
      }
    }

    // 2) Cancelled subscription: remove access
    if (stripeEvent.type === "customer.subscription.deleted") {
      const sub = stripeEvent.data.object;

      const { error } = await supabaseAdmin
        .from("profiles")
        .update({ status: "canceled" })
        .eq("stripe_subscription_id", sub.id);

      if (error) throw error;
    }

    return { statusCode: 200, body: "ok" };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};
