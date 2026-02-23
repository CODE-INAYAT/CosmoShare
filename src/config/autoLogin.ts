export const AUTO_LOGIN_ENABLED = true
export const AUTO_LOGIN_PASSWORD = process.env.NEXT_PUBLIC_AUTO_LOGIN_PASSWORD ?? ""

const C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&*'
const BASE = C.length // 68

function randChar(n: number): string {
    let s = ''
    for (let i = 0; i < n; i++) s += C[Math.floor(Math.random() * BASE)]
    return s
}

export function hashPassword(password: string = AUTO_LOGIN_PASSWORD): string {
    const salt = randChar(8)

    let encoded = ''
    for (let i = 0; i < password.length; i++) {
        const b = password.charCodeAt(i) ^ salt.charCodeAt(i % salt.length)
        encoded += C[Math.floor(b / BASE)] + C[b % BASE]
    }

    return salt + encoded + randChar(6)
}

export function verifyHash(hash: string, password: string = AUTO_LOGIN_PASSWORD): boolean {
    try {
        if (!hash || hash.length !== 30) return false

        const salt = hash.slice(0, 8)
        const encoded = hash.slice(8, 24) // 16 chars → 8 decoded bytes

        let decoded = ''
        for (let i = 0; i < encoded.length; i += 2) {
            const hi = C.indexOf(encoded[i])
            const lo = C.indexOf(encoded[i + 1])
            if (hi < 0 || lo < 0) return false
            const b = hi * BASE + lo
            decoded += String.fromCharCode(b ^ salt.charCodeAt((i / 2) % salt.length))
        }

        return decoded === password
    } catch {
        return false
    }
}
