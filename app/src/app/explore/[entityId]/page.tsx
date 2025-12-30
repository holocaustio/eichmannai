import type { Metadata } from 'next';
import EntityDetailClient from './EntityDetailClient';

interface PageProps {
  params: Promise<{ entityId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { entityId } = await params;
  const decodedId = decodeURIComponent(entityId);
  
  // Extract a readable name from the ID (remove underscores, etc.)
  const entityName = decodedId.replace(/_/g, ' ').replace(/-/g, ' ');
  
  return {
    title: entityName,
    description: `Learn about ${entityName} and its connections in the Eichmann Trial. Explore related witnesses, locations, and events.`,
    openGraph: {
      title: `${entityName} | The Eichmann Trial`,
      description: `${entityName} - Entity from the Eichmann Trial archive.`,
    },
  };
}

export default function EntityDetailPage() {
  return <EntityDetailClient />;
}
