import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Pronto',
  description: 'On-demand rides and delivery across the GTA',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
