import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...values: ClassValue[]) {
  return twMerge(clsx(values));
}
export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  return <button className={cn('button', `button-${variant}`, className)} {...props} />;
}
export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn('card', className)} {...props} />;
}
export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'green' | 'orange' | 'neutral' | 'blue';
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function Avatar({
  name,
  color = 'sage',
  small = false,
}: {
  name: string;
  color?: string;
  small?: boolean;
}) {
  return (
    <span aria-hidden="true" className={cn('avatar', `avatar-${color}`, small && 'avatar-small')}>
      {name.slice(-2)}
    </span>
  );
}
export function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon}
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
