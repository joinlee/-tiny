import { EntityCopier } from "../entityCopier";
import { EntityObject } from '../entityObject';
import { IDataContext, IEntityObject, IQueryObject } from '../tinyDB';
import mysql = require("mysql");

/**
 * EntityObject
 */
export class EntityObjectMysql<T extends IEntityObject> extends EntityObject<T> {
    id: string;
    toString(): string { return ""; }
    private ctx: IDataContext;
    private sqlTemp = [];
    private joinParms: {
        joinSql?: string; joinSelectFeild?: string; joinTableName: string;
    }[] = [];
    private queryParam: QueryParams = new Object() as QueryParams;
    constructor(ctx?: IDataContext) {
        super(ctx);
        this.ctx = ctx;
    }
    Where(qFn: (x: T) => boolean, paramsKey?: string[], paramsValue?: any[], entity?) {
        let tableName = "";
        if (entity) tableName = entity.toString();
        else tableName = this.toString();
        this.sqlTemp.push("(" + this.formateCode(qFn, tableName, paramsKey, paramsValue) + ")");
        return this;
    }
    Join<K extends IEntityObject>(qFn: (x: K) => void, entity: K, mainFeild?: string, isMainTable?: boolean) {
        let joinTableName = entity.toString().toLocaleLowerCase();
        let feild = this.formateCode(qFn);
        let mainTableName = this.toString();
        if (this.joinParms.length > 0 && !isMainTable) {
            mainTableName = this.joinParms[this.joinParms.length - 1].joinTableName;
        }
        if (mainFeild == null || mainFeild == undefined) mainFeild = "id";
        let sql = "LEFT JOIN `" + joinTableName + "` ON " + mainTableName + "." + mainFeild + " = " + joinTableName + "." + feild;


        this.joinParms.push({
            joinSql: sql,
            joinSelectFeild: this.GetSelectFieldList(entity).join(","),
            joinTableName: joinTableName
        });

        return this;
    }
    LeftJoin(entity: IEntityObject) {
        let joinTableName = entity.toString().toLocaleLowerCase();
        this.joinParms.push({
            joinSql: null,
            joinSelectFeild: this.GetSelectFieldList(entity).join(","),
            joinTableName: joinTableName
        });
        return this;
    }
    On(func: Function, mEntity?: IEntityObject) {
        let joinParmsItem = this.joinParms.find(x => x.joinSql == null);
        let joinTableName = joinParmsItem.joinTableName;
        let mainTableName = this.toString();
        if (mEntity) mainTableName = mEntity.toString().toLocaleLowerCase();

        let funcStr = func.toString();

        let fe = funcStr.substr(0, funcStr.indexOf("=>")).trim();
        funcStr = funcStr.replace(new RegExp(fe, "gm"), "");
        fe = fe.replace(/\(/g, "");
        fe = fe.replace(/\)/g, "");
        let felist = fe.split(",");
        let m = felist[0].trim();
        let f = felist[1].trim();

        let funcCharList = funcStr.split(" ");
        funcCharList[0] = "";
        funcCharList[1] = "";
        for (let i = 2; i < funcCharList.length; i++) {
            if (funcCharList[i].indexOf(m + ".") > -1) {
                funcCharList[i] = funcCharList[i].replace(new RegExp(m + "\\.", "gm"), "`" + mainTableName.toLocaleLowerCase() + "`.");
            }
            if (funcCharList[i].indexOf(f + ".") > -1) {
                funcCharList[i] = funcCharList[i].replace(new RegExp(f + "\\.", "gm"), "`" + joinTableName.toLocaleLowerCase() + "`.");
            }

            if (funcCharList[i] === "==") funcCharList[i] = " = ";
        }

        let sql = "LEFT JOIN `" + joinTableName + "` ON " + funcCharList.join("");
        joinParmsItem.joinSql = sql;

        return this;
    }
    private GetSelectFieldList(entity) {
        let tableName = entity.toString().toLocaleLowerCase();
        let feildList = [];
        for (let key in entity) {
            if (
                typeof (key) != "object"
                && typeof (key) != "function"
                && key != "sqlTemp"
                && key != "queryParam"
                && key != "ctx"
                && key != "joinParms"
            )
                feildList.push(tableName + ".`" + key + "` AS " + tableName + "_" + key);
        }
        return feildList;
    }
    Select(qFn: (x: T) => void) {
        let fileds = this.formateCode(qFn);
        this.queryParam.SelectFileds = fileds.split("AND");
        return this;
    }
    async Any(qFn: (entityObject: T) => boolean,
        paramsKey?: string[],
        paramsValue?: any[],
        queryCallback?: (result: boolean) => void): Promise<boolean> {
        let result = await this.Count(qFn, paramsKey, paramsValue, (queryCallback as any));
        return new Promise<boolean>((resolve, reject) => {
            resolve(result > 0);
        });
    }
    async Count(qFn?: (entityObject: T) => boolean, paramsKey?: string[], paramsValue?: any[], queryCallback?: (result: number) => void): Promise<number> {
        let sql = "";
        if (qFn) {
            sql = "SELECT COUNT(id) FROM `" + this.toString() + "` WHERE " + this.formateCode(qFn, null, paramsKey, paramsValue);
        }
        else {
            sql = "SELECT COUNT(id) FROM `" + this.toString() + "`";
        }

        sql = this.addQueryStence(sql) + ";";

        let r = await this.ctx.Query(sql);
        let result = r ? r[0]["COUNT(id)"] : 0;

        return new Promise<number>((resolve, reject) => {
            resolve(result);
        });
    }
    async Sum(qFn?: (entityObject: T) => void) {
        let queryFields = this.formateCode(qFn);
        let f = "SUM(" + queryFields + ")";
        let r = await this.GetQueryResult(f);

        this.joinParms = [];
        this.sqlTemp = [];

        let result = r ? r[0][f] : 0;

        return result;
    }
    Contains(feild: (x: T) => void, values: any[], entity?: IEntityObject) {
        let tableName = this.toString().toLocaleLowerCase();
        if (entity) {
            tableName = entity.toString().toLocaleLowerCase();
        }
        let filed = this.formateCode(feild);
        filed = tableName + "." + filed;
        let arr = values.slice();
        if (arr && arr.length > 0) {
            let sql = "";
            if (isNaN(arr[0])) {
                for (let i = 0; i < arr.length; i++) {
                    arr[i] = "'" + arr[i] + "'";
                }
            }
            sql = filed + " IN (" + arr.join(",") + ")";
            this.sqlTemp.push("(" + sql + ")");
        }
        return this;
    }
    async First(qFn?: (entityObject: T) => boolean,
        paramsKey?: string[],
        paramsValue?: any[],
        queryCallback?: (result: T) => void): Promise<T> {
        let sql: string;
        let queryFields = this.GetFinalQueryFields();
        if (qFn) {
            sql = "SELECT * FROM `" + this.toString() + "` WHERE " + this.formateCode(qFn, null, paramsKey, paramsValue);
        }
        else {
            sql = "SELECT * FROM `" + this.toString() + "`";
        }

        this.Skip(0);
        this.Take(1);
        sql = this.addQueryStence(sql) + ";";

        let row = await this.ctx.Query(sql);
        let obj;
        if (row && row[0]) {
            obj = row[0];
        }
        if (obj)
            return this.clone(EntityCopier.Decode(obj), new Object() as T);
        else return null;
    }
    Take(count: number) {
        this.queryParam.TakeCount = count;
        return this;
    }
    Skip(count: number) {
        this.queryParam.SkipCount = count;
        return this;
    }
    OrderBy(qFn: (x) => void, entity?, isDesc?: boolean) {
        let tableName = this.toString();
        if (entity) tableName = entity.toString();
        var sql = this.formateCode(qFn, tableName);
        if (this.queryParam.OrderByFeildName) {
            this.queryParam.OrderByFeildName.push({
                feild: sql,
                isDesc: isDesc
            });
        }
        else {
            this.queryParam.OrderByFeildName = [{
                feild: sql,
                isDesc: isDesc
            }];
        };
        return this;
    }
    OrderByDesc(qFn: (x) => void, entity?) {
        return this.OrderBy(qFn, entity, true);
    }
    GroupBy(qFn: (x: T) => void) {
        let fileds = this.formateCode(qFn, this.toString());
        this.queryParam.GroupByFeildName = fileds;
        return this;
    }
    private GetFinalQueryFields() {
        let feilds = "*";
        if (this.joinParms && this.joinParms.length > 0) {
            let wfs = this.GetSelectFieldList(this).join(",");
            feilds = wfs;
            for (let joinSelectFeild of this.joinParms) {
                feilds += ("," + joinSelectFeild.joinSelectFeild);
            }
        }
        return feilds;
    }
    async ToList<T>(queryCallback?: (result: T[]) => void) {
        let row;
        let queryFields = this.GetFinalQueryFields();
        return this.QueryList(queryFields);

    }
    private async QueryList(queryFields?) {
        let row;
        if (!queryFields)
            queryFields = this.GetFinalQueryFields();
        try {
            row = await this.GetQueryResult(queryFields);
            this.sqlTemp = [];
            if (row[0]) {
                if (this.joinParms && this.joinParms.length > 0) {
                    let newRows = [];
                    for (let rowItem of row) {
                        let newRow = {};
                        for (let feild in rowItem) {
                            let s = feild.split("_");
                            newRow[s[0]] || (newRow[s[0]] = {
                                toString: function () { return s[0]; }
                            });
                            if (rowItem[s[0] + "_id"] == null) {
                                newRow[s[0]] = null;
                                break;
                            }
                            else {
                                newRow[s[0]][s[1]] = rowItem[feild];
                            }
                        }

                        for (let objItem in newRow) {
                            if (newRow[objItem] != null)
                                newRow[objItem] = EntityCopier.Decode(newRow[objItem]);
                        }

                        newRows.push(newRow);
                    }
                    this.joinParms = [];

                    return newRows;
                }
                else {
                    return this.cloneList(row);
                }
            }
            else {
                this.joinParms = [];
                return [];
            }
        } catch (error) {
            throw error;
        } finally {
            this.joinParms = [];
            this.sqlTemp = [];
        }
    }
    private async GetQueryResult(queryFields) {
        let row;
        if (this.sqlTemp.length > 0) {
            let sql = "SELECT " + queryFields + " FROM `" + this.toString() + "` ";
            if (this.joinParms && this.joinParms.length > 0) {
                for (let joinItem of this.joinParms) {
                    sql += joinItem.joinSql + " ";
                }
            }
            sql += "WHERE " + this.sqlTemp.join(' AND '); 0
            sql = this.addQueryStence(sql) + ";";
            row = await this.ctx.Query(sql);
        }
        else {
            let sql = "SELECT " + queryFields + " FROM `" + this.toString() + "` ";
            if (this.joinParms && this.joinParms.length > 0) {
                for (let joinItem of this.joinParms) {
                    sql += joinItem.joinSql + " ";
                }
            }
            sql = this.addQueryStence(sql) + ";";
            row = await this.ctx.Query(sql);
        }

        return row;
    }
    Max(qFn: (x: T) => void): Promise<number> {
        return null;
    }
    Min(qFn: (x: T) => void): Promise<number> {
        return null;
    }

    private getParameterNames(fn) {
        const COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;
        const DEFAULT_PARAMS = /=[^,]+/mg;
        const FAT_ARROWS = /=>.*$/mg;
        const code = fn.toString()
            .replace(COMMENTS, '')
            .replace(FAT_ARROWS, '')
            .replace(DEFAULT_PARAMS, '');
        const result = code.slice(code.indexOf('(') + 1, code.indexOf(')') == -1 ? code.length : code.indexOf(')')).match(/([^\s,]+)/g);
        return result === null ? [] : result;
    }

    private formateCode(qFn, tableName?: string, paramsKey?: string[], paramsValue?: any[]): string {
        let qFnS: string = qFn.toString();
        qFnS = qFnS.replace(/function/g, "");
        qFnS = qFnS.replace(/return/g, "");
        qFnS = qFnS.replace(/if/g, "");
        qFnS = qFnS.replace(/else/g, "");
        qFnS = qFnS.replace(/true/g, "");
        qFnS = qFnS.replace(/false/g, "");
        qFnS = qFnS.replace(/\{/g, "");
        qFnS = qFnS.replace(/\}/g, "");
        qFnS = qFnS.replace(/\(/g, "");
        qFnS = qFnS.replace(/\)/g, "");
        qFnS = qFnS.replace(/\;/g, "");
        qFnS = qFnS.replace(/=>/g, "");
        qFnS = qFnS.trim();
        //p是参数
        let p: string = this.getParameterNames(qFn)[0];
        qFnS = qFnS.substring(p.length, qFnS.length);
        qFnS = qFnS.trim();
        if (tableName)
            qFnS = qFnS.replace(new RegExp(p + "\\.", "gm"), "`" + tableName + "`.");
        else
            qFnS = qFnS.replace(new RegExp(p + "\\.", "gm"), "");

        let indexOfFlag = qFnS.indexOf(".IndexOf") > -1;
        qFnS = qFnS.replace(new RegExp("\\.IndexOf", "gm"), " LIKE ");

        qFnS = qFnS.replace(/\&\&/g, "AND");
        qFnS = qFnS.replace(/\|\|/g, "OR");
        qFnS = qFnS.replace(/\=\=/g, "=");

        if (paramsKey && paramsValue) {
            qFnS = qFnS.replace(new RegExp("= null", "gm"), "IS NULL");
            if (paramsKey.length != paramsValue.length) throw 'paramsKey,paramsValue 参数异常';
            for (let i = 0; i < paramsKey.length; i++) {
                let v = paramsValue[i];
                if (indexOfFlag) {
                    let xx = mysql.escape(paramsValue[i]);
                    xx = xx.substring(1, xx.length - 1);
                    v = "LIKE '%" + xx + "%'";
                    qFnS = qFnS.replace(new RegExp("LIKE " + paramsKey[i], "gm"), v);
                }
                else {
                    let opchar = qFnS[qFnS.lastIndexOf(paramsKey[i]) - 2];
                    if (isNaN(v)) v = opchar + " " + mysql.escape(paramsValue[i]);
                    else v = opchar + " " + mysql.escape(paramsValue[i]);

                    if (paramsValue[i] === "" || paramsValue[i] === null || paramsValue[i] === undefined) {
                        v = "IS NULL";
                    }
                    qFnS = qFnS.replace(new RegExp(opchar + " " + paramsKey[i], "gm"), v);
                }
            }
        }
        else {
            qFnS = qFnS.replace(new RegExp("= null", "gm"), "IS NULL");
            if (indexOfFlag) {
                let s = qFnS.split(" ");
                let sIndex = s.findIndex(x => x === "LIKE");
                if (sIndex) {
                    let sStr = s[sIndex + 1];
                    sStr = sStr.substring(1, sStr.length - 1);
                    sStr = mysql.escape(sStr);
                    sStr = sStr.substring(1, sStr.length - 1);
                    s[sIndex + 1] = "'%" + sStr + "%'";
                    qFnS = s.join(' ');
                }
            }
        }
        return qFnS;
    }
    clone(source: any, destination: T, isDeep?: boolean): T {
        if (!source) return null;

        destination = JSON.parse(JSON.stringify(source));
        delete (destination as any).sqlTemp;
        delete (destination as any).queryParam;
        delete (destination as any).joinParms;
        delete (destination as any)._id;
        delete (destination as any).ctx;
        destination.toString = this.toString;
        return destination;
    }
    private cloneList(list: [any]): T[] {
        let r: T[] = [];
        list.forEach(x => {
            if (x) r.push(this.clone(EntityCopier.Decode(x), new Object() as T, false));
        });

        return r;
    }
    private addQueryStence(sql: string): string {
        if (this.queryParam.SelectFileds && this.queryParam.SelectFileds.length > 0) {
            sql = sql.replace(/\*/g, this.queryParam.SelectFileds.join(','));
        }
        if (this.queryParam.GroupByFeildName) {
            sql += " GROUP BY " + this.queryParam.GroupByFeildName;
        }
        if (this.queryParam.OrderByFeildName) {
            let orderByList = this.queryParam.OrderByFeildName.map(x => {
                let desc = x.isDesc ? "DESC" : "";
                return x.feild + " " + desc;
            });
            sql += " ORDER BY " + orderByList.join(",");
        }
        if (this.queryParam.TakeCount != null && this.queryParam.TakeCount != undefined) {
            if (this.queryParam.SkipCount == null && this.queryParam.SkipCount == undefined) this.queryParam.SkipCount = 0;
            sql += " LIMIT " + this.queryParam.SkipCount + "," + this.queryParam.TakeCount;
        }
        this.clearQueryParams();
        return sql;
    }
    private clearQueryParams(): void {
        this.queryParam = new Object() as QueryParams;
    }
}

interface QueryParams {
    TakeCount: number;
    SkipCount: number;
    OrderByFeildName: {
        feild: string;
        isDesc: boolean;
    }[];
    IsDesc: boolean;
    SelectFileds: string[];
    GroupByFeildName: string;
}