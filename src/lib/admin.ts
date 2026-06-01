// 管理者メールアドレス一覧
const ADMIN_EMAILS: string[] = [
  'wpuhs2216@gmail.com',
];

// 管理者判定
export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
