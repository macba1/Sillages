import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: 'default' | 'dark';
}

export function Card({ children, variant = 'default', className, ...props }: CardProps) {
  return (
    <div
      className={clsx(
        'border',
        variant === 'dark'
          ? 'bg-[#1A1A2E] border-white/10 text-white'
          : 'bg-white border-[#E8DDD6]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
