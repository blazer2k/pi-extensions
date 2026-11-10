import { writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("./", import.meta.url));
const stream = (data, dictionary = "") =>
  Buffer.concat([
    Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`),
    data,
    Buffer.from("\nendstream"),
  ]);
function document(contents, resources, resource) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << ${resources} >> /Contents 4 0 R >>`,
    stream(Buffer.from(contents)),
    resource,
  ];
  const chunks = [
    Buffer.from("%PDF-1.4\n"),
    Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]),
  ];
  const offsets = [0];
  let bytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  for (const [index, object] of objects.entries()) {
    offsets.push(bytes);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      Buffer.from(object),
      Buffer.from("\nendobj\n"),
    ]);
    chunks.push(chunk);
    bytes += chunk.length;
  }
  const xref = offsets
    .map((offset, index) =>
      index
        ? `${String(offset).padStart(10, "0")} 00000 n \n`
        : "0000000000 65535 f \n",
    )
    .join("");
  chunks.push(
    Buffer.from(
      `xref\n0 ${offsets.length}\n${xref}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${bytes}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}
await writeFile(
  join(directory, "readable.pdf"),
  document(
    "BT /F1 14 Tf 72 700 Td (OFFLINE_PDF_FIXTURE) Tj ET",
    "/Font << /F1 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ),
);
await writeFile(
  join(directory, "image-only.pdf"),
  document(
    "q 100 0 0 60 72 640 cm /Im0 Do Q",
    "/XObject << /Im0 5 0 R >>",
    stream(
      Buffer.from([32, 96, 160]),
      "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8",
    ),
  ),
);
