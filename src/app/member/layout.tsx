import type { Metadata } from "next";
import { MemberSessionProvider } from "@/component/member/MemberSession";

export const metadata: Metadata = {
  title: "ASC Member | SSU ASC",
  robots: { index: false, follow: false },
};

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return <MemberSessionProvider>{children}</MemberSessionProvider>;
}
