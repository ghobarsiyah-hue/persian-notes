import type { ComponentType, ReactNode } from 'react';

/** lucide icon at ribbon size (16px) */
export function h4(I: ComponentType<{ className?: string }>): ReactNode {
  return <I className="h-4 w-4" />;
}
