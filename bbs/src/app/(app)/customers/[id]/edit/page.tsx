import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { CustomerForm } from "@/components/customers/CustomerForm";

export default async function EditCustomerPage({
  params
}: {
  params: { id: string };
}) {
  await requireRole(Role.ADMIN, Role.STAFF);

  const customer = await prisma.customer.findUnique({
    where: { id: params.id }
  });
  if (!customer) notFound();

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Edit customer</h1>
      <CustomerForm
        mode="edit"
        id={customer.id}
        initial={{
          name: customer.name,
          company: customer.company ?? "",
          email: customer.email ?? "",
          phone: customer.phone ?? "",
          billingAddress: customer.billingAddress ?? "",
          taxId: customer.taxId ?? "",
          notes: customer.notes ?? ""
        }}
      />
    </div>
  );
}
