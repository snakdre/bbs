import { requireRole, Role } from "@/lib/permissions";
import { CustomerForm } from "@/components/customers/CustomerForm";

export default async function NewCustomerPage() {
  await requireRole(Role.ADMIN, Role.STAFF);
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">New customer</h1>
      <CustomerForm mode="create" />
    </div>
  );
}
