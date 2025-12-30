import type { Metadata } from 'next';
import OpeningStatementClient from './OpeningStatementClient';

export const metadata: Metadata = {
  title: "Opening Statement",
  description: "Attorney General Gideon Hausner's historic opening statement at the Eichmann Trial, April 1961. 'I do not stand alone. With me stand six million accusers.'",
  openGraph: {
    title: "Opening Statement | The Eichmann Trial",
    description: "Attorney General Gideon Hausner's historic opening statement, April 1961.",
  },
  keywords: ["Gideon Hausner", "Opening Statement", "Eichmann Trial", "Six Million Accusers"],
};

export default function OpeningStatementPage() {
  return <OpeningStatementClient />;
}
