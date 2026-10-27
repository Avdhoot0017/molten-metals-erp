import { redirect } from "next/navigation";

/**
 * The old Companies screen, now called Customers.
 *
 * Same table, same records - the shop calls them customers, so the page does
 * too. This redirect is here so a bookmark or an old link still lands
 * somewhere useful rather than on a 404.
 */
export default function CompaniesPage() {
  redirect("/customers");
}
