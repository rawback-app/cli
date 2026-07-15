import { commandOutput, createCommandClient, type ReadCommandDependencies } from "./command.ts";
import { pricingDocument } from "./features/pricing/view.ts";
import { CliPricingDocument, type CliPricingQuery } from "./gql/graphql.ts";

export type PricingInterval = "all" | "month" | "year";

export interface PricingOptions {
  interval?: PricingInterval;
  json?: boolean;
}

export type PricingDependencies = ReadCommandDependencies;
type PricingTier = CliPricingQuery["pricing"]["tiers"][number];
type PricingAddOn = CliPricingQuery["pricing"]["addOns"][number];

function serializeTier(tier: PricingTier) {
  return {
    id: tier.id,
    name: tier.name,
    price: tier.price,
    billingInterval: tier.billingInterval,
    storageGB: tier.storageGB,
    creditsPerMonth: tier.creditsPerMonth,
    faceRecPerMonth: tier.faceRecPerMonth,
    sharingPublic: tier.sharingPublic,
    sharingRestricted: tier.sharingRestricted,
    sharingUnlimited: tier.sharingUnlimited,
    priorityProcessing: tier.priorityProcessing,
  };
}

function serializeAddOn(addOn: PricingAddOn) {
  return {
    id: addOn.id,
    name: addOn.name,
    price: addOn.price,
    kind: addOn.kind,
    amount: addOn.amount,
    description: addOn.description,
  };
}

export async function runPricing(
  options: PricingOptions = {},
  dependencies: PricingDependencies = {},
): Promise<void> {
  const interval = options.interval ?? "all";
  if (!(["all", "month", "year"] as const).includes(interval)) {
    throw new Error("--interval must be one of: all, month, year");
  }
  const ui = commandOutput(dependencies);
  const result = await ui.withActivity(
    "Loading pricing…",
    async () => {
      const client = await createCommandClient(dependencies, false);
      return client.graphql.query({ query: CliPricingDocument });
    },
    !options.json,
  );
  if (result.error) throw result.error;
  if (!result.data) throw new Error("The pricing response did not include pricing data");

  const addOns = result.data.pricing.addOns;
  const tiers = result.data.pricing.tiers.filter(
    (tier) => interval === "all" || tier.price === 0 || tier.billingInterval === interval,
  );
  if (options.json) {
    ui.json({
      pricing: {
        tiers: tiers.map(serializeTier),
        addOns: addOns.map(serializeAddOn),
      },
    });
    return;
  }

  ui.document(pricingDocument(tiers, addOns));
}
