import { redirect } from "next/navigation";

import { AccountClient } from "@/components/account-client";
import { PageTitle } from "@/components/page-i18n";
import { getCurrentSafeUser } from "@/lib/auth";
import { hasRedisConfig } from "@/lib/redis";
import { pageTitle } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata = { title: pageTitle("账户设置") };

export default async function AccountPage() {
  if (!hasRedisConfig()) redirect("/chat");
  const user = await getCurrentSafeUser();
  if (!user) {
    redirect("/login?redirect=/account");
  }
  const me = user as NonNullable<typeof user>;

  return (
    <>
      <PageTitle titleKey="route.account" />
      <AccountClient
        user={{ id: me.id, email: me.email, role: me.role, createdAt: me.createdAt }}
      />
    </>
  );
}
