import "./globals.css";

export const metadata = {
  title: "Ponto | Espelho de jornada",
  description: "Registro e correção de ponto com regras de jornada por vigência.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
