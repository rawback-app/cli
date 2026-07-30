import { type CliPricingQuery } from '@rawback/sdk'

import { cell, type UiDocument } from '../../ui/model.ts'

type PricingTier = CliPricingQuery['pricing']['tiers'][number]
type PricingAddOn = CliPricingQuery['pricing']['addOns'][number]

function currency(cents: number): string {
  return '$' + (cents / 100).toFixed(2)
}

function availability(enabled: boolean) {
  return enabled ? cell('yes', { tone: 'success' }) : cell('no', { dim: true })
}

export function pricingDocument(tiers: PricingTier[], addOns: PricingAddOn[]): UiDocument {
  return {
    title: 'Pricing',
    blocks: [
      { type: 'text', text: 'Plans', bold: true },
      {
        type: 'table',
        emptyMessage: 'No pricing plans found.',
        columns: [
          { key: 'name', label: 'Plan', required: true, priority: 1, minWidth: 10 },
          { key: 'price', label: 'Price', required: true, priority: 1 },
          { key: 'interval', label: 'Interval', priority: 2 },
          { key: 'storage', label: 'Storage', priority: 2 },
          { key: 'credits', label: 'Credits/mo', priority: 3 },
          { key: 'faces', label: 'Face rec/mo', priority: 4 },
          { key: 'public', label: 'Public', priority: 5 },
          { key: 'restricted', label: 'Restricted', priority: 6 },
          { key: 'unlimited', label: 'Unlimited', priority: 7 },
          { key: 'priority', label: 'Priority', priority: 8 },
        ],
        rows: tiers.map((tier) => ({
          name: tier.name,
          price: tier.price === 0 ? cell('Free', { tone: 'success' }) : currency(tier.price),
          interval: tier.price === 0 ? 'forever' : tier.billingInterval,
          storage: String(tier.storageGB) + ' GB',
          credits: tier.creditsPerMonth,
          faces: tier.faceRecPerMonth,
          public: availability(tier.sharingPublic),
          restricted: availability(tier.sharingRestricted),
          unlimited: availability(tier.sharingUnlimited),
          priority: availability(tier.priorityProcessing),
        })),
      },
      { type: 'text', text: 'Add-ons', bold: true },
      {
        type: 'table',
        emptyMessage: 'No pricing add-ons found.',
        columns: [
          { key: 'name', label: 'Add-on', required: true, minWidth: 10 },
          { key: 'amount', label: 'Amount', priority: 1 },
          { key: 'price', label: 'Price', required: true, priority: 1 },
          { key: 'kind', label: 'Kind', priority: 2 },
          { key: 'description', label: 'Description', priority: 3, minWidth: 12 },
        ],
        rows: addOns.map((addOn) => ({
          name: addOn.name,
          amount: addOn.amount,
          price: currency(addOn.price),
          kind: addOn.kind,
          description: addOn.description,
        })),
      },
    ],
  }
}
