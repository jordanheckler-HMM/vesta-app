interface VestaFooterProps {
  compact?: boolean;
}

const VestaFooter = ({ compact = false }: VestaFooterProps) => {
  if (compact) {
    return null;
  }

  return (
    <footer className="border-t border-vesta-header-border bg-card">
      <div className="max-w-4xl mx-auto px-6 py-3">
        <p className="text-xs text-muted-foreground text-center">
          Chat history is session-scoped. Files added in the Files tab are stored locally for retrieval.
        </p>
        <p className="text-xs text-muted-foreground text-center mt-2">
          Internal use only. Not for legal, medical, or financial advice, customer-facing output, or automated decisions.
        </p>
      </div>
    </footer>
  );
};

export default VestaFooter;
