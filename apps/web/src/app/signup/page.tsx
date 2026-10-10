'use client';
import { OrgWizard } from '@/components/orgs';

/** Public sign-up: the same four steps as "Create organisation", plus your own sign-in. */
export default function SignupPage() {
  return <OrgWizard account onClose={() => { location.href = '/login'; }} />;
}
