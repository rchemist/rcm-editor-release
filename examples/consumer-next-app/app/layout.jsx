import '@rchemist/editor/styles.css';

export const metadata = { title: 'consumer-next-app', icons: { icon: 'data:,' } };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
