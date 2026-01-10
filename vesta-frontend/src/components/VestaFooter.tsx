const VestaFooter = () => {
  return (
    <footer className="border-t border-vesta-header-border bg-card">
      <div className="max-w-4xl mx-auto px-6 py-3">
        <p className="text-xs text-muted-foreground text-center">
          Vesta does not store conversations or retain memory across sessions. Internal use only.
        </p>
        <p className="text-xs text-muted-foreground text-center mt-2">
          Not for legal, medical, or financial advice. Not for customer-facing or automated decisions.
        </p>
      </div>
    </footer>
  );
};

export default VestaFooter;
