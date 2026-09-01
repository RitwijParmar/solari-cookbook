import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto"

export interface SignedProof<T> {
  readonly algorithm: "Ed25519"
  readonly keyId: string
  readonly publicKey: string
  readonly payload: T
  readonly payloadSha256: string
  readonly signature: string
}

export class EvidenceSigner {
  private readonly privateKey: string
  readonly publicKey: string
  readonly keyId: string

  constructor(privateKeyPem?: string) {
    if (privateKeyPem === undefined) {
      const pair = generateKeyPairSync("ed25519", {
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      })
      this.privateKey = pair.privateKey
      this.publicKey = pair.publicKey
    } else {
      this.privateKey = privateKeyPem
      this.publicKey = process.env.GHOSTACK_SIGNING_PUBLIC_KEY?.replaceAll("\\n", "\n") ?? createPublicKey(privateKeyPem).export({ type: "spki", format: "pem" }).toString()
    }
    this.keyId = createHash("sha256").update(this.publicKey).digest("hex").slice(0, 16)
  }

  create<T>(payload: T): SignedProof<T> {
    const bytes = Buffer.from(JSON.stringify(payload))
    return {
      algorithm: "Ed25519",
      keyId: this.keyId,
      publicKey: this.publicKey,
      payload,
      payloadSha256: createHash("sha256").update(bytes).digest("hex"),
      signature: sign(null, bytes, this.privateKey).toString("base64url"),
    }
  }
}

export function verifySignedProof<T>(proof: SignedProof<T>): boolean {
  const bytes = Buffer.from(JSON.stringify(proof.payload))
  const digest = createHash("sha256").update(bytes).digest("hex")
  return digest === proof.payloadSha256 && verify(
    null,
    bytes,
    proof.publicKey,
    Buffer.from(proof.signature, "base64url"),
  )
}
