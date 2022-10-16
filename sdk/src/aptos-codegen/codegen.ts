import fs from 'fs'
import path from 'path'
import prettier from 'prettier'
import { MoveFunction, MoveModule, MoveStruct, MoveModuleBytecode } from 'aptos/src/generated'
import { generateType, AccountRegister } from './typegen'
import { isFrameworkAccount } from '../aptos/utils'

export function generate(srcDir: string, outputDir: string) {
  const files = fs.readdirSync(srcDir)
  outputDir = path.resolve(outputDir)

  fs.mkdirSync(outputDir, { recursive: true })

  const loader = new AccountRegister()

  // The first path, identify import relation and module name (filename) of those imports
  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue
    }
    // Reading file is duplicated, but since they are small files probably file
    // TODO add file manager class
    const json = fs.readFileSync(path.join(srcDir, file), 'utf-8')
    const modules = JSON.parse(json)

    for (const module of modules) {
      if (module.abi) {
        loader.register(module.abi, path.basename(file, '.json'))
      }
    }
  }

  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue
    }
    const codeGen = new AccountCodegen(loader, {
      srcFile: path.join(srcDir, file),
      outputDir: outputDir,
    })

    codeGen.generate()
  }

  // when generating user code, don't need to generate framework account
  loader.pendingAccounts.delete('0x1')
  loader.pendingAccounts.delete('0x2')
  loader.pendingAccounts.delete('0x3')

  if (loader.pendingAccounts.size > 0) {
    // TODO automatic download dependencies
    console.error('Missing ABIs from the following accounts', loader.pendingAccounts)
  }
}

interface Config {
  srcFile: string
  outputDir: string
}

export class AccountCodegen {
  modules: MoveModuleBytecode[]
  config: Config
  loader: AccountRegister

  constructor(loader: AccountRegister, config: Config) {
    const json = fs.readFileSync(config.srcFile, 'utf-8')
    this.modules = JSON.parse(json)
    this.config = config
    this.loader = loader
  }

  generate() {
    if (!this.modules) {
      return
    }
    const baseName = path.basename(this.config.srcFile, '.json')

    let address: string | undefined
    for (const module of this.modules) {
      if (module.abi && module.abi.address) {
        address = module.abi.address
      }
    }
    if (!address) {
      return
    }

    const imports = `
    import { aptos } from "@sentio/sdk"
    import { Address, MoveModule } from "aptos/src/generated"
    `

    const dependedAccounts: string[] = []

    const moduleImports: string[] = []

    const info = this.loader.accountImports.get(address)

    if (info) {
      for (const [account, moduleImported] of info.imports.entries()) {
        // Remap to user's filename if possible, TODO codepath not well tested
        let tsAccountModule = './' + (this.loader.accountImports.get(account)?.moduleName || account)
        if (isFrameworkAccount(account) && !isFrameworkAccount(address)) {
          // Decide where to find runtime library
          let srcRoot = 'lib'
          if (__dirname.includes('sdk/src/aptos-codegen')) {
            srcRoot = 'src'
          }
          tsAccountModule = `@sentio/sdk/${srcRoot}/builtin/aptos/${account}`
        }
        const items = Array.from(moduleImported)
        moduleImports.push(`import { ${items.join(',')} } from "${tsAccountModule}"`)

        // Ideally we should use per module's load types, but it doesn't matter since we are loading the entire
        // account modules anyway
        items.forEach((m) => dependedAccounts.push(m))
      }
    }

    let source = `
    /* Autogenerated file. Do not edit manually. */
    /* tslint:disable */
    /* eslint-disable */
  
    /* Generated modules for account ${address} */
  
    ${imports}
    
    ${moduleImports.join('\n')}
    
    ${this.modules.map((m) => generateModule(m, dependedAccounts)).join('\n')}
    
    function loadAllTypes(registry: aptos.TypeRegistry) {
      ${dependedAccounts.map((m) => `${m}.loadTypes(registry)`).join('\n')}

      ${this.modules
        .map((m) => {
          return `registry.load(${m.abi?.name}.ABI)`
        })
        .join('\n')}
    }
    ` // source

    source = prettier.format(source, { parser: 'typescript' })
    fs.writeFileSync(path.join(this.config.outputDir, baseName + '.ts'), source)
  }
}

function generateModule(moduleByteCode: MoveModuleBytecode, dependedModules: string[]) {
  if (!moduleByteCode.abi) {
    return ''
  }
  const module = moduleByteCode.abi

  const functions = module.exposed_functions.map((f) => generateOnEntryFunctions(module, f)).filter((s) => s !== '')
  const events = module.structs.map((e) => generateOnEvents(module, e)).filter((s) => s !== '')
  const structs = module.structs.map((s) => generateStructs(module, s))
  const callArgs = module.exposed_functions.map((f) => generateCallArgsStructs(module, f))

  let processor = ''
  if (functions.length > 0 || events.length > 0) {
    processor = `export class ${module.name} extends aptos.AptosBaseProcessor {

    constructor(options: aptos.AptosBindOptions) {
      super("${module.name}", options)
    }
    static DEFAULT_OPTIONS: aptos.AptosBindOptions = {
      address: "${module.address}",
      network: aptos.AptosNetwork.TEST_NET       
    }

    static bind(options: Partial<aptos.AptosBindOptions> = {}): ${module.name} {
      return new ${module.name}({ ...${module.name}.DEFAULT_OPTIONS, ...options })
    }
    
    ${functions.join('\n')}
    
    ${events.join('\n')}
    
    loadTypesInternal(registry: aptos.TypeRegistry) {
      loadAllTypes(registry)
    }
  }
  `
  }

  return `
  ${processor}

  export namespace ${module.name} {
    ${structs.join('\n')}
    
    ${callArgs.join('\n')}
       
    export function loadTypes(registry: aptos.TypeRegistry) {
      loadAllTypes(registry)
    }
    export const ABI: MoveModule = JSON.parse('${JSON.stringify(module)}')
 }
  `
}

function generateStructs(module: MoveModule, struct: MoveStruct) {
  const genericString = generateStructTypeParameters(struct)

  const fields = struct.fields.map((field) => {
    return `${field.name}: ${generateType(field.type)}`
  })

  let eventPayload = ''
  if (isEvent(struct)) {
    eventPayload = `
    export interface ${struct.name}Instance${genericString} extends 
        aptos.TypedEventInstance<${struct.name}${genericString}> {
      data_typed: ${struct.name}${genericString}
    }
    `
  }

  return `
  export class ${struct.name}${genericString} {
    ${fields.join('\n')} 
  }
  
  ${eventPayload}
  `
}

function generateFunctionTypeParameters(func: MoveFunction) {
  let genericString = ''
  if (func.generic_type_params && func.generic_type_params.length > 0) {
    const params = func.generic_type_params
      .map((v, idx) => {
        return 'T' + idx
      })
      .join(',')
    genericString = `<${params}>`
  }
  return genericString
}

function generateStructTypeParameters(struct: MoveStruct) {
  let genericString = ''

  if (struct.generic_type_params && struct.generic_type_params.length > 0) {
    const params = struct.generic_type_params
      .map((v, idx) => {
        return 'T' + idx
      })
      .join(',')
    genericString = `<${params}>`
  }
  return genericString
}

function generateCallArgsStructs(module: MoveModule, func: MoveFunction) {
  if (!func.is_entry) {
    return
  }

  // the first param is always signer so ignore
  // TODO check if there is any edge case
  const fields = func.params.slice(1).map((param) => {
    return `${generateType(param)}`
  })

  const camelFuncName = capitalizeFirstChar(camelize(func.name))

  const genericString = generateFunctionTypeParameters(func)
  return `
  export interface ${camelFuncName}Payload${genericString} 
      extends aptos.TypedEntryFunctionPayload<[${fields.join(',')}]> {
    arguments_typed: [${fields.join(',')}]
  }
  `
}

function generateOnEntryFunctions(module: MoveModule, func: MoveFunction) {
  if (!func.is_entry) {
    return ''
  }

  const genericString = generateFunctionTypeParameters(func)

  const camelFuncName = capitalizeFirstChar(camelize(func.name))
  const source = `
  onEntry${camelFuncName}${genericString}(func: (call: ${module.name}.${camelFuncName}Payload${genericString}, ctx: aptos.AptosContext) => void): ${module.name} {
    this.onEntryFunctionCall(func, {
      function: '${module.name}::${func.name}'
    })
    return this
  }`

  return source
}

function isEvent(struct: MoveStruct) {
  return struct.abilities.includes('drop') && struct.abilities.includes('store') && struct.name.endsWith('Event')
}

function generateOnEvents(module: MoveModule, struct: MoveStruct): string {
  // for struct that has drop + store
  if (!isEvent(struct)) {
    return ''
  }
  const source = `
  onEvent${struct.name}(func: (event: ${module.name}.${struct.name}Instance, ctx: aptos.AptosContext) => void): ${module.name} {
    this.onEvent(func, {
      type: '${module.name}::${struct.name}'
    })
    return this
  }
  `
  return source
}

function camelize(input: string): string {
  return input
    .split('_')
    .reduce(
      (res, word, i) =>
        i === 0 ? word.toLowerCase() : `${res}${word.charAt(0).toUpperCase()}${word.substr(1).toLowerCase()}`,
      ''
    )
}

function capitalizeFirstChar(input: string): string {
  if (!input) {
    return input
  }
  return input[0].toUpperCase() + (input.length > 1 ? input.substring(1) : '')
}
