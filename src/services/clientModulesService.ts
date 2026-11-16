import { collection, deleteField, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { CLIENT_HOME_SETTING, CLIENT_MODULE_KEYS, CLIENT_MODULES, isClientModuleKey, workspaceTypeFields, workspaceTypeOf, type ClientModuleKey, type WorkspaceType } from '@/config/clientModules'
import { isPlatformAdmin } from '@/services/companiesService'
import type { FullIdentity } from '@/types/identity'

export type CompanyModulesRow = {
    code: string
    name: string
    modules: Record<ClientModuleKey, boolean>
    /** The module that opens as the staff home, if any. */
    homeModule: ClientModuleKey | null
    workspaceType: WorkspaceType
}

const modulesOf = (data: Record<string, unknown>) => Object.fromEntries(
    CLIENT_MODULE_KEYS.map((key) => [key, data[CLIENT_MODULES[key].setting] === true]),
) as Record<ClientModuleKey, boolean>

/** Platform admins only: every company with the client modules switched on for it. */
export const listCompanyModules = async (user: FullIdentity): Promise<CompanyModulesRow[]> => {
    if (!isPlatformAdmin(user)) throw new Error('forbidden')
    const snapshot = await getDocs(collection(getFirebaseDb(), 'companies'))
    return snapshot.docs
        .map((row) => {
            const data = row.data()
            const code = String(data.companyCode || row.id).trim()
            const name = String(data.companyName || data.name || data.displayName || code).trim()
            const home = data[CLIENT_HOME_SETTING]
            return { code, name: name || code, modules: modulesOf(data), homeModule: isClientModuleKey(home) ? home : null, workspaceType: workspaceTypeOf(data) }
        })
        .filter((row) => row.code)
        .sort((left, right) => left.name.localeCompare(right.name))
}

/** Platform admins only (firestore.rules enforce this too). Switching a module off also stops it being the home. */
export const setCompanyModule = async (user: FullIdentity, row: CompanyModulesRow, key: ClientModuleKey, enabled: boolean) => {
    if (!isPlatformAdmin(user)) throw new Error('forbidden')
    await updateDoc(doc(getFirebaseDb(), 'companies', row.code), {
        [CLIENT_MODULES[key].setting]: enabled,
        ...(!enabled && row.homeModule === key ? { [CLIENT_HOME_SETTING]: deleteField() } : {}),
        updatedAt: serverTimestamp(),
        updatedByUid: user.uid,
    })
}

/** Platform admins only: makes the company an Incubation or a Training workspace (see workspaceTypeFields). */
export const setCompanyWorkspaceType = async (user: FullIdentity, companyCode: string, type: WorkspaceType) => {
    if (!isPlatformAdmin(user)) throw new Error('forbidden')
    const fields = Object.fromEntries(Object.entries(workspaceTypeFields(type)).map(([field, value]) => [field, value === null ? deleteField() : value]))
    await updateDoc(doc(getFirebaseDb(), 'companies', companyCode), {
        ...fields,
        updatedAt: serverTimestamp(),
        updatedByUid: user.uid,
    })
}

/** Platform admins only. `null` returns the company's staff to the standard dashboard. */
export const setCompanyHomeModule = async (user: FullIdentity, companyCode: string, key: ClientModuleKey | null) => {
    if (!isPlatformAdmin(user)) throw new Error('forbidden')
    await updateDoc(doc(getFirebaseDb(), 'companies', companyCode), {
        [CLIENT_HOME_SETTING]: key ?? deleteField(),
        updatedAt: serverTimestamp(),
        updatedByUid: user.uid,
    })
}
