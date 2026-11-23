import assert from "node:assert";
import { syncSchemaPlan } from "../app/models/schema.server";

// Fake Admin API: records metafieldsSet calls, stores the shop's plan metafield.
function fakeAdmin(stored: string | null, subs: string[]) {
  const sets: any[] = [];
  const admin = {
    graphql: async (q: string, o?: any) => {
      let data: any = {};
      if (q.includes("ActivePlan")) data = { currentAppInstallation: { activeSubscriptions: subs.map((name) => ({ name, status: "ACTIVE" })) } };
      else if (q.includes("SeoSchemaPlan {") || q.includes("query SeoSchemaPlan")) data = { shop: { id: "gid://shopify/Shop/1", metafield: stored === null ? null : { value: stored } } };
      else if (q.includes("metafieldsSet")) { sets.push(o.variables.m[0]); stored = o.variables.m[0].value; data = { metafieldsSet: { userErrors: [] } }; }
      return new Response(JSON.stringify({ data }));
    },
  };
  return { admin, sets };
}

// no metafield yet, Free → writes "Free"
let f = fakeAdmin(null, []);
assert.equal(await syncSchemaPlan(f.admin), "Free");
assert.equal(f.sets.length, 1); assert.equal(f.sets[0].value, "Free"); assert.equal(f.sets[0].namespace, "easy_seo");

// already right → no write
f = fakeAdmin("Free", []);
await syncSchemaPlan(f.admin);
assert.equal(f.sets.length, 0);

// upgraded to Basic yearly → writes "Basic"
f = fakeAdmin("Free", ["Basic Yearly"]);
assert.equal(await syncSchemaPlan(f.admin), "Basic");
assert.equal(f.sets[0].value, "Basic");

// API failure never throws
const broken = { graphql: async () => { throw new Error("down"); } };
assert.equal(await syncSchemaPlan(broken, "Advanced"), "Advanced");

console.log("ALL SCHEMA TESTS PASSED");
