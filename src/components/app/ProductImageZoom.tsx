import { Dialog, DialogContent } from "@/components/ui/dialog";

export function ProductImageZoom({
  open,
  onOpenChange,
  src,
  alt,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  src: string | null | undefined;
  alt: string;
}) {
  if (!src) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(98vw,1040px)] w-full p-2 sm:p-4 border-border bg-background/98">
        <img
          src={src}
          alt={alt}
          className="w-full max-h-[min(90vh,900px)] object-contain rounded-lg mx-auto"
        />
      </DialogContent>
    </Dialog>
  );
}
