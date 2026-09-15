import type { ContractorSettingsInput } from "./contracts";

export type AddressParts = {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
};

export function formatAddress(value: AddressParts): string | null {
  const street = [value.addressLine1?.trim(), value.addressLine2?.trim()].filter(Boolean).join("\n");
  const region = [value.city?.trim(), [value.state?.trim(), value.postalCode?.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [street, region].filter(Boolean).join("\n") || null;
}

export const defaultContractorSettings: ContractorSettingsInput = {
  companyName: "Pro Angle Construction",
  contractorName: "Kevin Edinger",
  email: "proangleconstruction@gmail.com",
  phone: "440.429.3474",
  addressLine1: "188 Kaider Road",
  addressLine2: null,
  city: "Uniontown",
  state: "PA",
  postalCode: "15401"
};
