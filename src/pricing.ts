import { createCommandClient, output, type ReadCommandDependencies } from "./command.ts";
import { CliPricingDocument, type CliPricingQuery } from "./gql/graphql.ts";
import { formatBoolean, formatJson, formatTable } from "./output.ts";

export type PricingInterval = "all" | "month" | "year";

export interface PricingOptions {
  interval?: PricingInterval;
  json?: boolean;
}

export type PricingDependencies = ReadCommandDependencies;
type PricingTier = CliPricingQuery["pricing"]["tiers"][number];
type PricingAddOn = CliPricingQuery["pricing"]["addOns"][number];

function currency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

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
  const client = await createCommandClient(dependencies, false);
  const result = await client.graphql.query({ query: CliPricingDocument });
  if (result.error) throw result.error;
  if (!result.data) throw new Error("The pricing response did not include pricing data");

  const addOns = result.data.pricing.addOns;
  const tiers = result.data.pricing.tiers.filter(
    (tier) => interval === "all" || tier.price === 0 || tier.billingInterval === interval,
  );
  if (options.json) {
    output(
      dependencies,
      formatJson({
        pricing: {
          tiers: tiers.map(serializeTier),
          addOns: addOns.map(serializeAddOn),
        },
      }),
    );
    return;
  }

  const sections: string[] = [];
  sections.push(
    tiers.length === 0
      ? "PLANS\nNo pricing plans found."
      : `PLANS\n${formatTable(
          [
            "ID",
            "NAME",
            "PRICE",
            "INTERVAL",
            "STORAGE",
            "CREDITS/MO",
            "FACE REC/MO",
            "PUBLIC",
            "RESTRICTED",
            "UNLIMITED",
            "PRIORITY",
          ],
          tiers.map((tier) => [
            tier.id,
            tier.name,
            currency(tier.price),
            tier.price === 0 ? "forever" : tier.billingInterval,
            `${tier.storageGB} GB`,
            String(tier.creditsPerMonth),
            String(tier.faceRecPerMonth),
            formatBoolean(tier.sharingPublic),
            formatBoolean(tier.sharingRestricted),
            formatBoolean(tier.sharingUnlimited),
            formatBoolean(tier.priorityProcessing),
          ]),
        )}`,
  );
  sections.push(
    addOns.length === 0
      ? "ADD-ONS\nNo pricing add-ons found."
      : `ADD-ONS\n${formatTable(
          ["ID", "NAME", "KIND", "AMOUNT", "PRICE", "DESCRIPTION"],
          addOns.map((addOn) => [
            addOn.id,
            addOn.name,
            addOn.kind,
            String(addOn.amount),
            currency(addOn.price),
            addOn.description,
          ]),
        )}`,
  );
  output(dependencies, sections.join("\n\n"));
}
