import { redirect } from "next/navigation";

import { AdminClient } from "@/components/admin-client";
import { I18nText, PageTitle } from "@/components/page-i18n";
import { getCurrentSafeUser } from "@/lib/auth";
import { hasRedisConfig } from "@/lib/redis";
import { pageTitle } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata = { title: pageTitle("管理员") };

export default async function AdminPage() {
  if (!hasRedisConfig()) redirect("/chat");

  // ⚠️ 服务端权限校验：前端隐藏按钮不算权限控制
  const user = await getCurrentSafeUser();
  if (!user) {
    redirect("/login?redirect=/admin");
  }
  const me = user as NonNullable<typeof user>;
  if (me.role !== "admin") {
    return (
      <main className="flex min-h-screen-safe items-center justify-center px-4">
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-6 py-5 text-center">
          <h1 className="text-lg font-semibold text-destructive">
            <I18nText k="admin.denied" />
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            <I18nText k="admin.deniedDesc" />
          </p>
        </div>
      </main>
    );
  }

  return (
    <>
      <PageTitle titleKey="route.admin" />
      <AdminClient
        me={{ id: me.id, email: me.email, role: me.role, createdAt: me.createdAt }}
      />
    </>
  );
}
